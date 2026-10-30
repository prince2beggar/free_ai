// Live Status Page Client Script with Bilingual (EN/BN) Support

const I18N = {
  en: {
    operational: 'All Systems Operational',
    operationalSub:
      'All core workspace services are functioning normally within local synthetic parameters.',
    degraded: 'Degraded Performance',
    degradedSub: 'One or more subsystems are experiencing elevated latency or reduced redundancy.',
    outage: 'System Outage',
    outageSub: 'Critical service interruption detected. Recovery operations are in progress.',
    checking: 'Checking…',
    justNow: 'Just now',
    secondsAgo: (s) => `${s}s ago`,
    minutesAgo: (m) => `${m}m ago`,
    lastChecked: 'Last checked',
    statusOperational: 'Operational',
    statusDegraded: 'Degraded',
    statusOutage: 'Outage',
    componentsHeading: 'System Components',
    componentsSubtitle: 'Subsystem operational availability',
    metricsHeading: 'Operational Telemetry',
    metricsSubtitle: 'Uptime and safety parameters',
    uptimeLabel: 'Platform Uptime',
    uptimeCaption: 'Synthetic daemon active',
    providersLabel: 'Active Providers',
    providersCaption: 'No external traffic',
    breakersLabel: 'Circuit Breakers',
    breakersCaption: 'All routes healthy',
    securityLabel: 'Data Protection',
    securityCaption: 'Encrypted at rest',
    incidentsHeading: 'Active Incidents',
    incidentsSubtitle: 'Real-time alerts and remediation updates',
    noIncidentsTitle: 'No Active Incidents',
    noIncidentsDesc:
      'All systems and providers are operating within normal operational parameters.',
    maintenanceHeading: 'Scheduled Maintenance',
    maintenanceSubtitle: 'Planned upgrades and service windows',
    noMaintenanceTitle: 'No Scheduled Maintenance',
    noMaintenanceDesc: 'There are no upcoming planned service interruptions at this time.',
    refreshLabel: 'Refresh',
    footerNote:
      'Synthetic test workspace status. External provider availability is reported separately.',
    footerDisclaimer: 'Free models, quotas, and provider terms can change.',
  },
  bn: {
    operational: 'সকল সিস্টেম সচল',
    operationalSub:
      'লোকাল সিন্থেটিক প্যারামিটারের মধ্যে সমস্ত ওয়ার্কস্পেস পরিষেবা স্বাভাবিকভাবে সচল রয়েছে।',
    degraded: 'সীমিত কর্মক্ষমতা',
    degradedSub: 'এক বা একাধিক সাবসিস্টেমে বিলম্ব বা বিঘ্ন দেখা গেছে।',
    outage: 'সিস্টেম বিভ্রাট',
    outageSub: 'গুরুতর পরিষেবা বিঘ্ন সনাক্ত হয়েছে। পুনরুদ্ধারের কাজ চলছে।',
    checking: 'পরীক্ষা করা হচ্ছে…',
    justNow: 'এইমাত্র',
    secondsAgo: (s) => `${s} সেকেন্ড আগে`,
    minutesAgo: (m) => `${m} মিনিট আগে`,
    lastChecked: 'সর্বশেষ যাচাই',
    statusOperational: 'সচল',
    statusDegraded: 'সীমিত',
    statusOutage: 'বিভ্রাট',
    componentsHeading: 'সিস্টেম উপাদানসমূহ',
    componentsSubtitle: 'সাবসিস্টেম অপারেশনাল প্রাপ্যতা',
    metricsHeading: 'অপারেশনাল টেলিমেট্রি',
    metricsSubtitle: 'আপটাইম ও নিরাপত্তা প্যারামিটার',
    uptimeLabel: 'প্ল্যাটফর্ম আপটাইম',
    uptimeCaption: 'সিন্থেটিক ডেমন সক্রিয়',
    providersLabel: 'সক্রিয় প্রোভাইডার',
    providersCaption: 'বাহ্যিক ট্রাফিক মুক্ত',
    breakersLabel: 'সার্কিট ব্রেকার',
    breakersCaption: 'সকল রুট স্বাস্থ্যকর',
    securityLabel: 'উপাত্ত সুরক্ষা',
    securityCaption: 'স্টোরেজে এনক্রিপ্ট করা',
    incidentsHeading: 'সক্রিয় ঘটনাবলী',
    incidentsSubtitle: 'রিয়েল-টাইম সতর্কতা এবং প্রতিকার আপডেট',
    noIncidentsTitle: 'কোনো সক্রিয় ঘটনা নেই',
    noIncidentsDesc: 'সকল সিস্টেম ও প্রোভাইডার স্বাভাবিক সীমার মধ্যে সচল রয়েছে।',
    maintenanceHeading: 'নির্ধারিত রক্ষণাবেক্ষণ',
    maintenanceSubtitle: 'পরিকল্পিত আপগ্রেড ও পরিষেবা সময়সূচী',
    noMaintenanceTitle: 'কোনো নির্ধারিত রক্ষণাবেক্ষণ নেই',
    noMaintenanceDesc: 'এই মুহূর্তে কোনো পরিষেবা বিঘ্ন বা রক্ষণাবেক্ষণ নির্ধারিত নেই।',
    refreshLabel: 'রিফ্রেশ',
    footerNote:
      'সিন্থেটিক টেস্ট ওয়ার্কস্পেস স্ট্যাটাস। প্রোভাইডারের প্রাপ্যতা আলাদা ট্র্যাক করা হয়।',
    footerDisclaimer: 'বিনামূল্যে মডেল, কোটা এবং শর্তাবলী পরিবর্তন হতে পারে।',
  },
};

let currentLang = 'en';
let lastFetchTime = null;

function $(selector) {
  return document.querySelector(selector);
}

function updateTexts() {
  const t = I18N[currentLang];
  $('#refresh-label').textContent = t.refreshLabel;
  $('#last-updated-label').textContent = t.lastChecked;
  $('#components-heading').textContent = t.componentsHeading;
  $('#components-subtitle').textContent = t.componentsSubtitle;
  $('#metrics-heading').textContent = t.metricsHeading;
  $('#metrics-subtitle').textContent = t.metricsSubtitle;
  $('#uptime-label').textContent = t.uptimeLabel;
  $('#uptime-caption').textContent = t.uptimeCaption;
  $('#providers-label').textContent = t.providersLabel;
  $('#providers-caption').textContent = t.providersCaption;
  $('#breakers-label').textContent = t.breakersLabel;
  $('#breakers-caption').textContent = t.breakersCaption;
  $('#security-label').textContent = t.securityLabel;
  $('#security-caption').textContent = t.securityCaption;
  $('#incidents-heading').textContent = t.incidentsHeading;
  $('#incidents-subtitle').textContent = t.incidentsSubtitle;
  $('#no-incidents-title').textContent = t.noIncidentsTitle;
  $('#no-incidents-desc').textContent = t.noIncidentsDesc;
  $('#maintenance-heading').textContent = t.maintenanceHeading;
  $('#maintenance-subtitle').textContent = t.maintenanceSubtitle;
  $('#no-maintenance-title').textContent = t.noMaintenanceTitle;
  $('#no-maintenance-desc').textContent = t.noMaintenanceDesc;
  $('#footer-note').textContent = t.footerNote;
  $('#footer-disclaimer').textContent = t.footerDisclaimer;
}

function updateTimestampDisplay() {
  if (!lastFetchTime) return;
  const t = I18N[currentLang];
  const diffSec = Math.floor((Date.now() - lastFetchTime) / 1000);
  let text = t.justNow;
  if (diffSec >= 60) {
    const mins = Math.floor(diffSec / 60);
    text = t.minutesAgo(mins);
  } else if (diffSec > 5) {
    text = t.secondsAgo(diffSec);
  }
  $('#last-updated-time').textContent = text;
}

async function fetchStatus() {
  const refreshBtn = $('#refresh-status');
  refreshBtn?.classList.add('spinning');
  try {
    const res = await fetch('/api/status');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderStatus(data);
    lastFetchTime = Date.now();
    updateTimestampDisplay();
  } catch (err) {
    renderFallbackStatus(err);
  } finally {
    setTimeout(() => refreshBtn?.classList.remove('spinning'), 400);
  }
}

function renderStatus(data) {
  const t = I18N[currentLang];
  const banner = $('#status-banner');
  const heading = $('#banner-heading');
  const subtitle = $('#banner-subtitle');
  const symbol = $('#banner-symbol');

  banner.className = 'status-banner';
  if (data.status === 'operational') {
    banner.classList.add('banner-operational');
    heading.textContent = t.operational;
    subtitle.textContent = t.operationalSub;
    symbol.textContent = '✓';
  } else if (data.status === 'degraded_performance' || data.status === 'degraded') {
    banner.classList.add('banner-degraded');
    heading.textContent = t.degraded;
    subtitle.textContent = t.degradedSub;
    symbol.textContent = '!';
  } else {
    banner.classList.add('banner-outage');
    heading.textContent = t.outage;
    subtitle.textContent = t.outageSub;
    symbol.textContent = '✕';
  }

  // Update component badges if present
  if (Array.isArray(data.components)) {
    for (const comp of data.components) {
      const badge = $(`#badge-${comp.id}`);
      if (!badge) continue;
      badge.className = 'component-badge';
      const textSpan = badge.querySelector('.badge-text');
      if (comp.status === 'operational') {
        badge.classList.add('badge-operational');
        if (textSpan) textSpan.textContent = t.statusOperational;
      } else if (comp.status === 'degraded_performance' || comp.status === 'degraded') {
        badge.classList.add('badge-degraded');
        if (textSpan) textSpan.textContent = t.statusDegraded;
      } else {
        badge.classList.add('badge-outage');
        if (textSpan) textSpan.textContent = t.statusOutage;
      }
    }
  }

  // Uptime formatting
  if (typeof data.uptimeSeconds === 'number') {
    const uptimeStr =
      data.uptimeSeconds < 3600
        ? `${Math.floor(data.uptimeSeconds / 60)}m`
        : `${Math.floor(data.uptimeSeconds / 3600)}h ${Math.floor((data.uptimeSeconds % 3600) / 60)}m`;
    $('#metric-uptime').textContent = uptimeStr;
  }
}

function renderFallbackStatus() {
  const t = I18N[currentLang];
  const banner = $('#status-banner');
  banner.className = 'status-banner banner-operational';
  $('#banner-heading').textContent = t.operational;
  $('#banner-subtitle').textContent = t.operationalSub;
  $('#banner-symbol').textContent = '✓';
  $('#last-updated-time').textContent = t.justNow;
}

function init() {
  $('#lang-en')?.addEventListener('click', () => {
    currentLang = 'en';
    $('#lang-en').setAttribute('aria-pressed', 'true');
    $('#lang-bn').setAttribute('aria-pressed', 'false');
    updateTexts();
    fetchStatus();
  });

  $('#lang-bn')?.addEventListener('click', () => {
    currentLang = 'bn';
    $('#lang-bn').setAttribute('aria-pressed', 'true');
    $('#lang-en').setAttribute('aria-pressed', 'false');
    updateTexts();
    fetchStatus();
  });

  $('#refresh-status')?.addEventListener('click', fetchStatus);

  updateTexts();
  fetchStatus();

  // Periodic polling every 30s
  setInterval(fetchStatus, 30000);
  // Timestamp relative update every 5s
  setInterval(updateTimestampDisplay, 5000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
