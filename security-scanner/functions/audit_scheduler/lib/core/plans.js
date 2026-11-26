'use strict';

const PLANS = {
  free: {
    id: 'free', name: 'Free', price: '€0',
    detailedReport: false, // severity-ranked list of issues only
    schedules: false,
    exportJson: false,
    maxTargets: 3,
    manualAuditsPerDay: 10,
  },
  pro: {
    id: 'pro', name: 'Pro', price: '€19 / month',
    detailedReport: true, // + explanation, evidence, remediation steps, CWE/OWASP refs
    schedules: true, // daily / weekly / monthly audits with e-mailed reports
    exportJson: true,
    maxTargets: 50,
    manualAuditsPerDay: 200,
  },
};

const planFor = (user) => PLANS[user?.plan] || PLANS.free;

module.exports = { PLANS, planFor };
